terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "6.14.1"
    }
  }
  backend "s3" {
    bucket = "tw100d-tfstate-17b8d6"
    key    = "terraform.tfstate"
    region = "us-west-2"
  }
}

provider "aws" {
  region = "us-west-2"
}

locals {
  webapp_bucket = "tw100d-webapp-nio3ix"

  # The W100 race server sends no CORS headers on any host, so the browser can
  # never call it directly. CloudFront fronts it as a second origin instead of
  # a Lambda: this app is read-only, so there is nothing for a function to do
  # that a proxying behavior cannot.
  w100_host = "w100as.web.app"
}

# State bucket is created out-of-band before the first `terraform init` (the
# S3 backend cannot bootstrap the bucket that holds its own state), then
# adopted here so its settings are managed.
resource "aws_s3_bucket" "terraform_state" {
  bucket = "tw100d-tfstate-17b8d6"

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id
  versioning_configuration {
    status = "Enabled"
  }
}

# Frontend bucket -- private, reachable only through CloudFront's OAC.
resource "aws_s3_bucket" "webapp" {
  bucket = local.webapp_bucket
}

resource "aws_s3_bucket_public_access_block" "webapp" {
  bucket                  = aws_s3_bucket.webapp.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

data "aws_iam_policy_document" "s3_policy" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.webapp.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = [module.cloudfront.cloudfront_distribution_arn]
    }
  }
}

resource "aws_s3_bucket_policy" "bucket_policy" {
  bucket = aws_s3_bucket.webapp.id
  policy = data.aws_iam_policy_document.s3_policy.json

  depends_on = [aws_s3_bucket_public_access_block.webapp]
}

# Volunteers all refresh the same station, so a short TTL collapses a crowd of
# refreshes into one hit on the W100 race server. Keyed per URL, so each aid
# station caches separately.
resource "aws_cloudfront_cache_policy" "w100_short" {
  name        = "tw100d-w100-short-ttl"
  comment     = "15s TTL for W100 proxy responses"
  min_ttl     = 0
  default_ttl = 15
  max_ttl     = 30

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true

    cookies_config {
      cookie_behavior = "none"
    }
    headers_config {
      header_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "all"
    }
  }
}

module "cloudfront" {
  source  = "terraform-aws-modules/cloudfront/aws"
  version = "5.0.0"

  aliases = []

  is_ipv6_enabled = true
  price_class     = "PriceClass_100"

  default_root_object = "index.html"

  create_origin_access_control = true
  origin_access_control = {
    s3_oac = {
      description      = "CloudFront access to S3"
      origin_type      = "s3"
      signing_behavior = "always"
      signing_protocol = "sigv4"
    }
  }

  # A SPA served from S3 404s on any deep link, so both error codes are folded
  # back to index.html.
  custom_error_response = [
    {
      error_code         = 403
      response_code      = 200
      response_page_path = "/index.html"
    },
    {
      error_code         = 404
      response_code      = 200
      response_page_path = "/index.html"
    },
  ]

  origin = {
    webapp = {
      domain_name           = aws_s3_bucket.webapp.bucket_regional_domain_name
      origin_access_control = "s3_oac"
    }
    w100 = {
      domain_name = local.w100_host
      # Supplies the /api prefix, so /w100/aid-station/4/times reaches
      # https://w100as.web.app/api/aid-station/4/times.
      origin_path = "/api"
      custom_origin_config = {
        http_port              = 80
        https_port             = 443
        origin_protocol_policy = "https-only"
        origin_ssl_protocols   = ["TLSv1.2"]
      }
    }
  }

  default_cache_behavior = {
    target_origin_id = "webapp"

    compress               = true
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]

    use_forwarded_values = false

    # CachingOptimized
    cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"
  }

  ordered_cache_behavior = [
    {
      path_pattern     = "/w100/*"
      target_origin_id = "w100"

      compress               = true
      viewer_protocol_policy = "redirect-to-https"
      allowed_methods        = ["GET", "HEAD", "OPTIONS"]
      cached_methods         = ["GET", "HEAD"]

      use_forwarded_values = false

      cache_policy_id = aws_cloudfront_cache_policy.w100_short.id

      # Deliberately NO origin_request_policy: Firebase Hosting routes on the
      # Host header, so CloudFront must send the origin's own host rather than
      # forwarding the viewer's. AllViewer/AllViewerExceptHostHeader break this.

      function_association = {
        viewer-request = {
          function_arn = aws_cloudfront_function.strip_w100_prefix.arn
        }
      }
    },
    {
      path_pattern     = "/index.html"
      target_origin_id = "webapp"

      compress               = true
      viewer_protocol_policy = "redirect-to-https"
      allowed_methods        = ["GET", "HEAD", "OPTIONS"]
      cached_methods         = ["GET", "HEAD"]

      use_forwarded_values = false

      # CachingDisabled -- index.html must never be stale, it names the hashed
      # asset bundles.
      cache_policy_id = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
    },
  ]
}

# origin_path prepends /api but the /w100 prefix still has to come off, so a
# viewer-request function rewrites the URI before it reaches the origin.
resource "aws_cloudfront_function" "strip_w100_prefix" {
  name    = "tw100d-strip-w100-prefix"
  runtime = "cloudfront-js-2.0"
  comment = "Rewrites /w100/<path> to /<path> so origin_path can supply /api"
  publish = true
  code    = <<-JS
    function handler(event) {
      var request = event.request;
      request.uri = request.uri.replace(/^\/w100/, "");
      if (request.uri === "") {
        request.uri = "/";
      }
      return request;
    }
  JS
}

output "distribution_domain_name" {
  value = module.cloudfront.cloudfront_distribution_domain_name
}

output "distribution_id" {
  value = module.cloudfront.cloudfront_distribution_id
}

output "webapp_bucket" {
  value = aws_s3_bucket.webapp.id
}
